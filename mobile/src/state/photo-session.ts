// Module-level store for passing photo URIs between screens.
// Avoids URL serialization of file:// and content:// URIs in router params,
// which can break on Android when content URIs contain percent-encoded sequences.
let _pendingImageUri: string | null = null;

export function setPendingImageUri(uri: string | null): void {
  _pendingImageUri = uri;
}

export function consumePendingImageUri(): string | null {
  const uri = _pendingImageUri;
  _pendingImageUri = null;
  return uri;
}
