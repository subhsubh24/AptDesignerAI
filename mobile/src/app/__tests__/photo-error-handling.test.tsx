import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import PhotoCaptureScreen from '@/app/photo';

/**
 * Regression guard: `pickFromGallery` and `takePhoto` in photo.tsx (the
 * FIRST screen of the core photo->analysis funnel) were `async` handlers
 * passed directly to `onPress` with no try/catch, unlike every other async
 * handler in this app (settings.tsx, saved.tsx, results.tsx). Any rejection
 * inside (a revoked permission, a native module error, the app backgrounding
 * mid-pick) became an unhandled promise rejection with zero user feedback —
 * the button silently did nothing.
 */

jest.mock('expo-router', () => ({
  useRouter: () => ({ back: jest.fn(), push: jest.fn(), replace: jest.fn() }),
}));

jest.mock('expo-haptics', () => ({
  notificationAsync: jest.fn(),
  impactAsync: jest.fn(),
  NotificationFeedbackType: { Success: 'success' },
  ImpactFeedbackStyle: { Medium: 'medium' },
}));

const mockRequestMediaLibraryPermissionsAsync = jest.fn();
const mockRequestCameraPermissionsAsync = jest.fn();
jest.mock('expo-image-picker', () => ({
  requestMediaLibraryPermissionsAsync: (...args: unknown[]) =>
    mockRequestMediaLibraryPermissionsAsync(...args),
  requestCameraPermissionsAsync: (...args: unknown[]) =>
    mockRequestCameraPermissionsAsync(...args),
  launchImageLibraryAsync: jest.fn(),
  launchCameraAsync: jest.fn(),
  getPendingResultAsync: jest.fn(() => Promise.resolve(null)),
  MediaTypeOptions: { Images: 'Images' },
}));

jest.mock('@/state/photo-session', () => ({ setPendingImageUri: jest.fn() }));

describe('photo.tsx — unhandled-rejection guard on pickFromGallery / takePhoto', () => {
  let alertSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    alertSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it('surfaces an alert (not an unhandled rejection) when the library-permission request rejects', async () => {
    mockRequestMediaLibraryPermissionsAsync.mockRejectedValue(new Error('native module crashed'));
    await render(<PhotoCaptureScreen />);

    const galleryButton = screen.getByLabelText('Choose from library');
    fireEvent.press(galleryButton);

    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalledWith(
        'Something went wrong',
        expect.stringContaining('photo library'),
      );
    });
    expect(warnSpy).toHaveBeenCalledWith('pickFromGallery failed', expect.any(Error));
  });

  it('surfaces an alert (not an unhandled rejection) when the camera-permission request rejects', async () => {
    mockRequestCameraPermissionsAsync.mockRejectedValue(new Error('native module crashed'));
    await render(<PhotoCaptureScreen />);

    const cameraButton = screen.getByLabelText('Take a photo');
    fireEvent.press(cameraButton);

    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalledWith(
        'Something went wrong',
        expect.stringContaining('camera'),
      );
    });
    expect(warnSpy).toHaveBeenCalledWith('takePhoto failed', expect.any(Error));
  });

  it('still shows the normal permission-needed alert on a clean (non-throwing) denial', async () => {
    mockRequestMediaLibraryPermissionsAsync.mockResolvedValue({ granted: false, canAskAgain: true });
    await render(<PhotoCaptureScreen />);

    fireEvent.press(screen.getByLabelText('Choose from library'));

    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalledWith(
        'Permission needed',
        expect.stringContaining('photo library'),
        expect.anything(),
      );
    });
    // Not the error-path alert/warn.
    expect(warnSpy).not.toHaveBeenCalled();
  });
});
