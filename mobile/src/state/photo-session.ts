// Module-level store for passing photo URIs and room type between screens.
// Avoids URL serialization of file:// and content:// URIs in router params,
// which can break on Android when content URIs contain percent-encoded sequences.
let _pendingImageUri: string | null = null;
let _pendingRoomType: string | null = null;

export function setPendingImageUri(uri: string | null): void {
  _pendingImageUri = uri;
}

export function consumePendingImageUri(): string | null {
  const uri = _pendingImageUri;
  _pendingImageUri = null;
  return uri;
}

export function setPendingRoomType(roomType: string | null): void {
  _pendingRoomType = roomType;
}

export function consumePendingRoomType(): string | null {
  const rt = _pendingRoomType;
  _pendingRoomType = null;
  return rt;
}
