import { validateAgainstDirtyHashes } from './dirtyHashes'
import { BigNumber, Hash, Utils } from '@bsv/sdk'

import { asArray, asBuffer, asString } from '../../../../utility/utilityHelpers.buffer'
import { doubleSha256BE, doubleSha256LE } from '../../../../utility/utilityHelpers'
import { BaseBlockHeader, BlockHeader } from '../Api/BlockHeaderApi'
import { Chain } from '../../../../sdk/types'

/**
 * Computes sha256 hash of file contents read as bytes with no encoding.
 * @param filepath Full filepath to file.
 * @param bufferSize Optional read buffer size to use. Defaults to 80,000 bytes.
 * @returns `{hash, length}` where `hash` is base64 string form of file hash and `length` is file length in bytes.
 */
/*
export async function sha256HashOfBinaryFile(
  filepath: string,
  bufferSize = 80000
): Promise<{ hash: string; length: number }> {
  const file = await fs.open(filepath, 'r')
  try {
    let length = 0

    const sha256 = new Hash.SHA256()
    const readBuf = Buffer.alloc(bufferSize)

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const rr = await file.read(readBuf, 0, readBuf.length)
      if (!rr.bytesRead) break
      length += rr.bytesRead
      sha256.update(asArray(rr.buffer))
    }

    return { hash: Utils.toBase64(sha256.digest()), length }
  } finally {
    await file.close()
  }
}
*/

/**
 * Validate headers contained in an array of bytes. The headers must be consecutive block headers, 80 bytes long,
 *  where the hash of each header equals the previousHash of the following header.
 * @param buffer Buffer of headers to be validated.
 * @param previousHash Expected previousHash of first header.
 * @param offset Optional starting offset within `buffer`.
 * @param count Optional number of headers to validate. Validates to end of buffer if missing.
 * @returns Header hash of last header validated or previousHash if there where none.
 */
export function validateBufferOfHeaders(buffer: number[], previousHash: string, offset = 0, count = -1): string {
  if (count < 0) count = Math.floor((buffer.length - offset) / 80)
  count = Math.max(0, count)
  let lastHeaderHash = previousHash
  for (let i = 0; i < count; i++) {
    const headerStart = offset + i * 80
    const headerEnd = headerStart + 80
    if (headerEnd > buffer.length) {
      throw {
        message: `header ${i} missing bytes for header at offset ${headerStart} in buffer of length ${buffer.length}`
      }
    }
    const header = buffer.slice(headerStart, headerEnd)
    const hashPrev = asString(header.slice(4, 36).reverse())
    if (lastHeaderHash !== hashPrev)
      throw { message: `header ${i} invalid previousHash ${lastHeaderHash} vs ${hashPrev}` }
    lastHeaderHash = asString(doubleSha256BE(header))
    validateAgainstDirtyHashes(lastHeaderHash)
  }
  return lastHeaderHash
}

/**
 * @param work chainWork as a BigNumber
 * @returns Converted chainWork value from BN to hex string of 32 bytes.
 */
export function workBNtoBuffer(work: BigNumber): string {
  return work.toString(16).padStart(64, '0')
}

/**
 * Returns true if work1 is more work (greater than) work2
 */
export function isMoreWork(work1: string, work2: string): boolean {
  return new BigNumber(asArray(work1), 16).gt(new BigNumber(asArray(work2), 16))
}

/**
 * Add two Buffer encoded chainwork values
 * @returns Sum of work1 + work2 as Buffer encoded chainWork value
 */
export function addWork(work1: string, work2: string): string {
  const sum = new BigNumber(asArray(work1), 16).add(new BigNumber(asArray(work2), 16))
  return workBNtoBuffer(sum)
}

/**
 * Subtract Buffer encoded chainwork values
 * @returns work1 - work2 as Buffer encoded chainWork value
 */
export function subWork(work1: string, work2: string): string {
  const sum = new BigNumber(asArray(work1), 16).sub(new BigNumber(asArray(work2), 16))
  return workBNtoBuffer(sum)
}

/**
 * Computes "target" value for 4 byte Bitcoin block header "bits" value.
 * @param bits number or converted from Buffer using `readUint32LE`
 * @returns 32 byte Buffer with "target" value
 */
export function convertBitsToTarget(bits: number | number[]): BigNumber {
  if (Array.isArray(bits)) bits = readUInt32LE(bits, 0)

  const shift = (bits >> 24) & 0xff
  const data = bits & 0x007fffff

  const target = new BigNumber(data)
  if (shift <= 3) {
    target.iushrn(8 * (3 - shift))
  } else {
    target.iushln(8 * (shift - 3))
  }

  return target
}

/**
 * Computes "chainWork" value for 4 byte Bitcoin block header "bits" value.
 * @param bits number or converted from Buffer using `readUint32LE`
 * @returns 32 byte Buffer with "chainWork" value
 */
export function convertBitsToWork(bits: number | number[]): string {
  const target = convertBitsToTarget(bits)

  // convert target to work
  const work = target.notn(256).div(target.addn(1)).addn(1)

  return work.toString(16).padStart(64, '0')
}

export function deserializeBaseBlockHeaders(
  buffer: number[],
  offset = 0,
  count?: number | undefined
): BaseBlockHeader[] {
  const headers: BaseBlockHeader[] = []
  while ((!count || headers.length < count) && offset + 80 <= buffer.length && offset >= 0) {
    headers.push(deserializeBlockHeader(buffer, offset))
    offset += 80
  }
  return headers
}

export function deserializeBlockHeaders(
  firstHeight: number,
  buffer: number[],
  offset = 0,
  count?: number | undefined
): BlockHeader[] {
  const headers: BlockHeader[] = []
  let nextHeight = firstHeight
  while ((!count || headers.length < count) && offset + 80 <= buffer.length && offset >= 0) {
    const baseBuffer = buffer.slice(offset, offset + 80)
    const base = deserializeBlockHeader(baseBuffer)
    const header = {
      ...base,
      height: nextHeight++,
      hash: asString(blockHash(baseBuffer))
    }
    headers.push(header)
    offset += 80
  }
  return headers
}

/**
 * Extract an array of block hashes and of merkleRoots from a buffer of serialized block headers.
 * @param buffer
 */
export function extractHashesAndRoots(buffer: Buffer): { hashes: Buffer[]; merkleRoots: Buffer[] } {
  const hashes: Buffer[] = []
  const merkleRoots: Buffer[] = []
  for (let i = 0; i < buffer.length / 80; i++) {
    const offset = i * 80
    const hash = asBuffer(doubleSha256LE(asArray(buffer.subarray(offset, 80 + offset))).reverse())
    const merkleRoot = buffer.subarray(36 + offset, 68 + offset).reverse()
    hashes.push(hash)
    merkleRoots.push(merkleRoot)
  }
  return { hashes, merkleRoots }
}

/**
 * Given a block header, ensures that its format is correct. This does not
 * check its difficulty or validity relative to the chain of headers.
 *
 * Throws on format errors.
 *
 * @param The header to validate
 *
 * @returns true if the header is correctly formatted
 */
export function validateHeaderFormat(header: BlockHeader): void {
  const ALLOWED_KEYS = {
    version: true,
    previousHash: true,
    merkleRoot: true,
    time: true,
    bits: true,
    nonce: true,
    height: true,
    hash: true
  }

  const UINT_MAX = 0xffffffff

  /**
   * Root object checks
   */
  if (typeof header === 'undefined') {
    throw new Error('Missing header.')
  }
  if (typeof header !== 'object') {
    throw new Error('Header must be an object.')
  }
  if (!Object.keys(header).every(key => ALLOWED_KEYS[key])) {
    throw new Error('Header contains extra properties.')
  }

  /**
   * Version
   */
  if (typeof header.version !== 'number') {
    throw new Error('Header version must be a number.')
  }
  if (!Number.isInteger(header.version)) {
    throw new Error('Header version must be an integer.')
  }
  if (header.version < 0 || header.version > UINT_MAX) {
    throw new Error(`Header version must be between 0 and ${UINT_MAX}.`)
  }

  /**
   * Height
   */
  if (typeof header.height !== 'number') {
    throw new Error('Header height must be a number.')
  }
  if (!Number.isInteger(header.height)) {
    throw new Error('Header height must be an integer.')
  }
  if (header.height < 0 || header.height > UINT_MAX / 2) {
    throw new Error(`Header version must be between 0 and ${UINT_MAX / 2}.`)
  }

  /**
   * Previous hash
   */
  if (header.previousHash.length !== 64) {
    throw new Error('Header previousHash must be 32 hex bytes.')
  }

  /**
   * Merkle root
   */
  if (header.merkleRoot.length !== 64) {
    throw new Error('Header merkleRoot must be 32 hex bytes.')
  }

  /**
   * Time
   */
  if (typeof header.time !== 'number') {
    throw new Error('Header time must be a number.')
  }
  if (!Number.isInteger(header.time)) {
    throw new Error('Header time must be an integer.')
  }
  if (header.time < 0 || header.time > UINT_MAX) {
    throw new Error(`Header time must be between 0 and ${UINT_MAX}.`)
  }

  /**
   * Bits
   */
  if (typeof header.bits !== 'number') {
    throw new Error('Header bits must be a number.')
  }
  if (!Number.isInteger(header.bits)) {
    throw new Error('Header bits must be an integer.')
  }
  if (header.bits < 0 || header.bits > UINT_MAX) {
    throw new Error(`Header bits must be between 0 and ${UINT_MAX}.`)
  }

  /**
   * Nonce
   */
  if (typeof header.nonce !== 'number') {
    throw new Error('Header nonce must be a number.')
  }
  if (!Number.isInteger(header.nonce)) {
    throw new Error('Header nonce must be an integer.')
  }
  if (header.nonce < 0 || header.nonce > UINT_MAX) {
    throw new Error(`Header nonce must be between 0 and ${UINT_MAX}.`)
  }

  /**
   * Hash
   */
  if (header.hash.length !== 64) {
    throw new Error('Header hash must be 32 hex bytes.')
  }
  if (header.hash !== asString(blockHash(header))) {
    throw new Error('Header hash is invalid.')
  }
}

/**
 * Ensures that a header has a valid proof-of-work
 * Requires chain is 'main'
 *
 * @param header The header to validate
 *
 * @returns true if the header is valid
 */
export function validateHeaderDifficulty(hash: Buffer, bits: number) {
  const hashBN = new BigNumber(asArray(hash))

  const target = convertBitsToTarget(bits)

  if (hashBN.lte(target)) return true

  throw new Error('Block hash is not less than specified target.')
}

/**
 * Computes double sha256 hash of bitcoin block header
 * bytes are reversed to bigendian order
 *
 * If header is a Buffer, it is required to 80 bytes long
 * and in standard block header serialized encoding.
 *
 * @returns doule sha256 hash of header bytes reversed
 * @publicbody
 */
export function blockHash(header: BaseBlockHeader | number[]): string {
  const a = !Array.isArray(header) ? serializeBlockHeader(header) : header
  if (a.length !== 80) throw new Error('Block header must be 80 bytes long.')
  return asString(doubleSha256BE(a))
}

/**
 * Serializes a block header as an 80 byte Buffer.
 * The exact serialized format is defined in the Bitcoin White Paper
 * such that computing a double sha256 hash of the buffer computes
 * the block hash for the header.
 * @returns 80 byte Buffer
 * @publicbody
 */
export function serializeBlockHeader(header: BaseBlockHeader, buffer?: number[], offset?: number): number[] {
  const writer = new Utils.Writer()
  writer.writeUInt32LE(header.version)
  writer.write(asArray(header.previousHash).reverse())
  writer.write(asArray(header.merkleRoot).reverse())
  writer.writeUInt32LE(header.time)
  writer.writeUInt32LE(header.bits)
  writer.writeUInt32LE(header.nonce)
  const data = writer.toArray()
  if (buffer) {
    offset ||= 0
    buffer.splice(offset, buffer.length, ...data)
  }
  return data
}

/**
 * Deserialize a block header from an 80 byte buffer
 * @publicbody
 */
export function deserializeBlockHeader(buffer: number[], offset = 0): BaseBlockHeader {
  const reader = new Utils.Reader(buffer, offset)
  const header: BaseBlockHeader = {
    version: reader.readUInt32LE(),
    previousHash: asString(reader.read(32).reverse()),
    merkleRoot: asString(reader.read(32).reverse()),
    time: reader.readUInt32LE(),
    bits: reader.readUInt32LE(),
    nonce: reader.readUInt32LE()
  }
  return header
}

/**
 * Returns the genesis block for the specified chain.
 * @publicbody
 */
export function genesisHeader(chain: Chain): BlockHeader {
  return chain === 'main'
    ? {
        version: 1,
        previousHash: '0000000000000000000000000000000000000000000000000000000000000000',
        merkleRoot: '4a5e1e4baab89f3a32518a88c31bc87f618f76673e2cc77ab2127b7afdeda33b',
        time: 1231006505,
        bits: 486604799,
        nonce: 2083236893,
        height: 0,
        hash: '000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f'
      }
    : {
        version: 1,
        previousHash: '0000000000000000000000000000000000000000000000000000000000000000',
        merkleRoot: '4a5e1e4baab89f3a32518a88c31bc87f618f76673e2cc77ab2127b7afdeda33b',
        time: 1296688602,
        bits: 486604799,
        nonce: 414098458,
        height: 0,
        hash: '000000000933ea01ad0ee984209779baaec3ced90fa3f408719526f8d77f4943'
      }
}

/**
 * Returns the genesis block for the specified chain.
 * @publicbody
 */
export function genesisBuffer(chain: Chain): number[] {
  return serializeBlockHeader(genesisHeader(chain))
}

/**
 * Returns a copy of a Buffer with byte order reversed.
 * @returns new buffer with byte order reversed.
 * @publicbody
 */
export function swapByteOrder(buffer: number[]): number[] {
  return buffer.slice().reverse()
}

/**
 * @param num a number value in the Uint32 value range
 * @param littleEndian true for little-endian byte order in Buffer
 * @returns four byte buffer with Uint32 number encoded
 * @publicbody
 */
export function convertUint32ToBuffer(n: number, littleEndian = true): number[] {
  const a = [
    n & 0xff, // lowest byte
    (n >> 8) & 0xff,
    (n >> 16) & 0xff,
    (n >> 24) & 0xff // highest byte
  ]
  return littleEndian ? a : a.reverse()
}

export function writeUInt32LE(n: number, a: number[], offset: number): number {
  a[offset++] = n & 0xff // lowest byte
  a[offset++] = (n >> 8) & 0xff
  a[offset++] = (n >> 16) & 0xff
  a[offset++] = (n >> 24) & 0xff // highest byte
  return offset
}

export function writeUInt32BE(n: number, a: number[], offset: number): number {
  a[offset++] = (n >> 24) & 0xff // highest byte
  a[offset++] = (n >> 16) & 0xff
  a[offset++] = (n >> 8) & 0xff
  a[offset++] = n & 0xff // lowest byte
  return offset
}

export function readUInt32LE(a: number[], offset: number): number {
  return a[offset++] | (a[offset++] << 8) | (a[offset++] << 16) | (a[offset++] << 24)
}

export function readUInt32BE(a: number[], offset: number): number {
  return (a[offset++] << 24) | (a[offset++] << 16) | (a[offset++] << 8) | a[offset++]
}

/**
 * @param buffer four byte buffer with Uint32 number encoded
 * @param littleEndian true for little-endian byte order in Buffer
 * @returns a number value in the Uint32 value range
 * @publicbody
 */
export function convertBufferToUint32(buffer: number[], littleEndian = true): number {
  const a = littleEndian ? buffer : buffer.slice().reverse()
  const n = a[0] | (a[1] << 8) | (a[2] << 16) | (a[3] << 24)
  return n
}
