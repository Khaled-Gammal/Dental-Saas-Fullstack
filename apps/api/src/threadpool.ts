// Must be the first import in main.ts and worker.ts, before anything touches the libuv threadpool.
// scrypt (password hashing), DNS lookups and file I/O share this pool; the default of 4 threads caps
// logins at ~40/s per process (measured ~100 ms per scrypt). Use one thread per CPU core instead.
import { availableParallelism } from 'node:os';

process.env.UV_THREADPOOL_SIZE ??= String(Math.min(Math.max(availableParallelism(), 4), 64));
