// Module-level store for passing photo URIs and room type between screens.
// Avoids URL serialization of file:// and content:// URIs in router params,
// which can break on Android when content URIs contain percent-encoded sequences.
//
// peek* reads without clearing — safe for screens that may remount (e.g. results
// navigated to from room-type after backing out). set* / clear* are called
// explicitly rather than through a consume-once pattern to avoid data loss on
// back/forward navigation.
let _pendingImageUri: string | null = null;
let _pendingRoomType: string | null = null;

export function setPendingImageUri(uri: string | null): void {
  _pendingImageUri = uri;
}

export function peekPendingImageUri(): string | null {
  return _pendingImageUri;
}

export function setPendingRoomType(roomType: string | null): void {
  _pendingRoomType = roomType;
}

export function peekPendingRoomType(): string | null {
  return _pendingRoomType;
}
