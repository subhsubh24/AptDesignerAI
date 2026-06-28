import { ConfigContext, ExpoConfig } from "expo/config";

// Dynamic Expo config.
//
// Expo loads the static `app.json` first and passes it in as `config`; this
// function overlays the parts that must NOT be hardcoded in the repo. Today
// that is the EAS project id, which is read from the `EAS_PROJECT_ID`
// environment variable (set locally in `mobile/.env.local`, or as an EAS
// environment variable for CI builds — see PENDING_OPS.md). `eas init` also
// writes the id here automatically. Keeping it out of `app.json` means the
// committed config carries no account-specific identifiers.
//
// `use-push-notifications.ts` resolves the id via
// `Constants.expoConfig?.extra?.eas?.projectId`, so this is the single source
// of truth for Expo push token registration and EAS project linking.
export default ({ config }: ConfigContext): ExpoConfig => {
  const projectId = process.env.EAS_PROJECT_ID;

  return {
    ...config,
    // `name`/`slug` are required by ExpoConfig and always come from app.json,
    // but TypeScript treats the inherited values as optional, so restate them.
    name: config.name ?? "AptDesignerAI",
    slug: config.slug ?? "aptdesignerai",
    extra: {
      ...config.extra,
      eas: projectId ? { projectId } : config.extra?.eas,
    },
  };
};
