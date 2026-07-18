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

// Wipe the in-memory pending photo/room-type. This module state outlives an
// auth session (it lives at module scope, not in a React tree), so it MUST be
// cleared on sign-out / account deletion — otherwise on a shared device the
// next user who opens the photo flow would see the previous user's pending
// room photo and selected room type (cross-user data leak).
export function clearPendingSession(): void {
  _pendingImageUri = null;
  _pendingRoomType = null;
}
