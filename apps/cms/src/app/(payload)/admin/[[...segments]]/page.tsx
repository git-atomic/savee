/* THIS FILE WAS GENERATED AUTOMATICALLY BY PAYLOAD. */
/* DO NOT MODIFY IT BECAUSE IT COULD BE REWRITTEN AT ANY TIME. */
import config from "@payload-config";
import { RootPage } from "@payloadcms/next/views";

type Args = {
  params: Promise<{ segments: string[] }>;
  searchParams: Promise<{ [key: string]: string | string[] }>;
};

export default async function Page({ params, searchParams }: Args) {
  "use server";
  // RootPage expects a promise for config; wrap it
  const configPromise = Promise.resolve(config as any);
  // Build importMap inline to avoid module type conflicts
  const [
    RunStateCell,
    BlockPreviewCell,
    BlockUsersCell,
    MultiOriginCell,
    SaveeUserAvatarCell,
    EngineUI,
    EngineSandbox,
  ] = await Promise.all([
    import("@/components/RunStateCell").then((m) => m.default),
    import("@/components/BlockPreviewCell").then((m) => m.default),
    import("@/components/BlockUsersCell").then((m) => m.default),
    import("@/components/MultiOriginCell").then((m) => m.default),
    import("@/components/SaveeUserAvatarCell").then((m) => m.default),
    import("@/components/EngineUI").then((m) => m.default),
    import("@/components/EngineSandbox").then((m) => m.default),
  ]);

  const resolvedImportMap: Record<string, any> = {
    "@/components/RunStateCell#default": RunStateCell,
    "@/components/BlockPreviewCell#default": BlockPreviewCell,
    "@/components/BlockUsersCell#default": BlockUsersCell,
    "@/components/MultiOriginCell#default": MultiOriginCell,
    "@/components/SaveeUserAvatarCell#default": SaveeUserAvatarCell,
    "@/components/EngineUI#default": EngineUI,
    "@/components/EngineSandbox#default": EngineSandbox,
  };

  return RootPage({
    config: configPromise as any,
    importMap: resolvedImportMap,
    params,
    searchParams,
  });
}
