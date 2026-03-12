export function assertNodeRuntime(): void {
  if (process.env.NEXT_RUNTIME !== 'nodejs') {
    throw new Error('This module must run in the Node runtime.');
  }
}
