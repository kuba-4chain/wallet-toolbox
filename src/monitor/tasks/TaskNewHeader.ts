import { BlockHeader } from '../../services/chaintracker/chaintracks/Api/BlockHeaderApi'
import { Monitor } from '../Monitor'
import { WalletMonitorTask } from './WalletMonitorTask'

/**
 * This task polls for new block headers performing two essential functions:
 * 1. The arrival of a new block is the right time to check for proofs for recently broadcast transactions.
 * 2. The height of the block is used to limit which proofs are accepted with the aim of avoiding re-orged proofs.
 *
 * The most common new block orphan is one which is almost immediately orphaned.
 * Waiting a minute before pursuing proof requests avoids almost all the re-org work that could be done.
 * Thus this task queues new headers for one cycle.
 * If a new header arrives during that cycle, it replaces the queued header and delays again.
 * Only when there is an elapsed cycle without a new header does proof solicitation get triggered,
 * with that header height as the limit for which proofs are accepted.
 */
export class TaskNewHeader extends WalletMonitorTask {
  static taskName = 'NewHeader'
  /**
   * This is always the most recent chain tip header returned from the chaintracker.
   */
  header?: BlockHeader
  /**
   * Tracks the value of `header` except that it is set to undefined
   * when a cycle without a new header occurs and `processNewBlockHeader` is called.
   */
  queuedHeader?: BlockHeader

  constructor(
    monitor: Monitor,
    public triggerMsecs = 1 * monitor.oneMinute
  ) {
    super(monitor, TaskNewHeader.taskName)
  }

  async getHeader(): Promise<BlockHeader> {
    return await this.monitor.chaintracks.findChainTipHeader()
  }

  trigger(nowMsecsSinceEpoch: number): { run: boolean } {
    const run = true
    return { run }
  }

  async runTask(): Promise<string> {
    let log = ''
    const oldHeader = this.header
    this.header = await this.getHeader()
    let isNew = true
    if (!oldHeader) {
      log = `first header: ${this.header.height} ${this.header.hash}`
    } else if (oldHeader.height < this.header.height) {
      const skip = this.header.height - oldHeader.height - 1
      const skipped = skip > 0 ? ` SKIPPED ${skip}` : ''
      log = `new header: ${this.header.height} ${this.header.hash}${skipped}`
    } else if (oldHeader.height === this.header.height && oldHeader.hash != this.header.hash) {
      log = `reorg header: ${this.header.height} ${this.header.hash}`
    } else {
      isNew = false
    }
    if (isNew) {
      this.queuedHeader = this.header
    } else if (this.queuedHeader) {
      // Only process new block header if it has remained the chain tip for a full cycle
      log = `process header: ${this.header.height} ${this.header.hash}`
      this.monitor.processNewBlockHeader(this.queuedHeader)
      this.queuedHeader = undefined
    }
    return log
  }
}
