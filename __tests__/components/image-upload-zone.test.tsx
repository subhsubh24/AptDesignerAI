// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ImageUploadZone } from "@/components/rooms/image-upload-zone";

// react-dropzone's own drop handling reads the dropped files off
// `event.dataTransfer` (via the `file-selector` package); jsdom doesn't
// implement a real DataTransfer, so a plain object with `files`/`items` is
// the standard way to simulate a drag-and-drop drop event in RTL.
function dropFile(target: HTMLElement, file: File) {
  const dataTransfer = {
    files: [file],
    items: [{ kind: "file", type: file.type, getAsFile: () => file }],
    types: ["Files"],
  };
  fireEvent.drop(target, { dataTransfer });
}

function getDropzone() {
  // getRootProps() (the drag/drop handlers) and getInputProps() (the hidden
  // file input) live on sibling elements — the input's aria-label is the
  // stable way to reach the root, since the component has no other selector.
  return screen.getByLabelText("Upload room photo").closest("div") as HTMLElement;
}

beforeEach(() => {
  // jsdom does not implement URL.createObjectURL/revokeObjectURL.
  global.URL.createObjectURL = vi.fn(() => "blob:mock-preview");
  global.URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("ImageUploadZone", () => {
  it("shows an optimistic preview, then calls onUploadComplete on a successful drop", async () => {
    const onUploadComplete = vi.fn();
    // A fetch that resolves instantly makes the intermediate "uploading"
    // state too transient for RTL to reliably observe (React can batch the
    // preview-in / preview-out updates into a single commit). Hold the first
    // fetch open so the optimistic-preview state is deterministically
    // observable before resolving it.
    let resolveUpload!: (value: { ok: true; json: () => Promise<{ url: string; path: string }> }) => void;
    const uploadPromise = new Promise((resolve) => { resolveUpload = resolve; });
    global.fetch = vi
      .fn()
      .mockReturnValueOnce(uploadPromise)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: "img-1" }) }) as unknown as typeof fetch;

    render(<ImageUploadZone roomId="room-1" onUploadComplete={onUploadComplete} />);
    dropFile(getDropzone(), new File(["fake-bytes"], "sofa.jpg", { type: "image/jpeg" }));

    expect(await screen.findByAltText("Uploading preview")).toBeInTheDocument();

    resolveUpload({ ok: true, json: async () => ({ url: "/uploads/a.jpg", path: "a.jpg" }) });

    await waitFor(() =>
      expect(onUploadComplete).toHaveBeenCalledWith({ url: "/uploads/a.jpg", path: "a.jpg", id: "img-1" })
    );
    expect(screen.queryByAltText("Uploading preview")).not.toBeInTheDocument();
  });

  it("shows a dismissible error — never a silent failure — when the upload request fails", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: "storage is down" }),
    }) as unknown as typeof fetch;

    render(<ImageUploadZone roomId="room-1" />);
    dropFile(getDropzone(), new File(["fake-bytes"], "sofa.jpg", { type: "image/jpeg" }));

    expect(await screen.findByText("storage is down")).toBeInTheDocument();
    expect(screen.queryByAltText("Uploading preview")).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Dismiss error"));
    expect(screen.queryByText("storage is down")).not.toBeInTheDocument();
  });

  it("shows an error, not silence, when a non-image file is dropped (the pre-existing gap)", async () => {
    // Before this change, `useDropzone`'s fileRejections were never read —
    // react-dropzone routes an unsupported type to fileRejections, never to
    // onDrop's acceptedFiles, so a rejected drop produced zero user feedback.
    global.fetch = vi.fn() as unknown as typeof fetch;
    render(<ImageUploadZone roomId="room-1" />);
    dropFile(getDropzone(), new File(["%PDF-1.4"], "floor-plan.pdf", { type: "application/pdf" }));

    expect(await screen.findByText(/floor-plan\.pdf" isn't a supported image type/)).toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("a fresh rejection replaces a stale upload-failure message, rather than sitting behind it", async () => {
    // Regression guard for a review-caught bug: uploadError only clears on a
    // successful onDrop (never called for a rejected file) or the dismiss
    // button — so a rejection landing after a prior FAILED upload must not
    // leave the old, unrelated error message stuck on screen.
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: "storage is down" }),
    }) as unknown as typeof fetch;

    render(<ImageUploadZone roomId="room-1" />);
    const dropzone = getDropzone();

    dropFile(dropzone, new File(["fake-bytes"], "sofa.jpg", { type: "image/jpeg" }));
    expect(await screen.findByText("storage is down")).toBeInTheDocument();

    dropFile(dropzone, new File(["%PDF-1.4"], "floor-plan.pdf", { type: "application/pdf" }));
    expect(await screen.findByText(/floor-plan\.pdf" isn't a supported image type/)).toBeInTheDocument();
    expect(screen.queryByText("storage is down")).not.toBeInTheDocument();
  });
});
