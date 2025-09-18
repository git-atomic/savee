/* THIS FILE WAS GENERATED AUTOMATICALLY BY PAYLOAD. */
/* DO NOT MODIFY IT BECAUSE IT COULD BE REWRITTEN AT ANY TIME. */
import type { Metadata } from "next";

import config from "@payload-config";
import { NotFoundPage, generatePageMetadata } from "@payloadcms/next/views";
// importMap is a CommonJS module; load dynamically to be robust

type Args = {
  params: Promise<{
    segments: string[];
  }>;
  searchParams: Promise<{
    [key: string]: string | string[];
  }>;
};

export const generateMetadata = ({
  params,
  searchParams,
}: Args): Promise<Metadata> =>
  generatePageMetadata({ config, params, searchParams });

const NotFound = async ({ params, searchParams }: Args) => {
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

  return NotFoundPage({
    config,
    params,
    searchParams,
    importMap: resolvedImportMap,
  });
};

export default NotFound;
