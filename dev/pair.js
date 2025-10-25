// @ts-check
import { Duplex } from 'streamx';
import FramedStream from 'framed-stream';
import duplexThrough from 'duplex-through';
/**
 * Create an in-memory pair of connected streamx Duplexes.
 * Browser-safe (no Node streams). Writes on one side are pushed as readable
 * data on the other side. Destroy/close is propagated.
 *
 * @returns {[Duplex, Duplex]}
 */
export function createDuplexPair () {
  const [a, b] = duplexThrough();
  // Wrap each endpoint in a FramedStream so Protomux sees message boundaries
  return [new FramedStream(a), new FramedStream(b)];
}
