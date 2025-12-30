/* Unified root layout using Payload's RootLayout to avoid nested html/body */
import config from "@payload-config";
import "../../../globals.css";
import "@payloadcms/next/css";
import type { ServerFunctionClient } from "payload";
import { handleServerFunctions, RootLayout } from "@payloadcms/next/layouts";
import React from "react";

import ClientBootstrap from "@/components/ClientBootstrap";
import { importMap } from "./admin/importMap.js";

export const metadata = {
  title: "ScrapeSavee",
  description: "Admin & engine UI",
};

type Args = { children: React.ReactNode };

export default async function AppRootLayout({ children }: Args) {

  const serverFunction: ServerFunctionClient = async function (args) {
    "use server";
    return handleServerFunctions({
      ...args,
      config,
      importMap,
    });
  };

  return (
    <RootLayout
      config={config}
      importMap={importMap}
      serverFunction={serverFunction}
    >
      <ClientBootstrap />
      {children}
    </RootLayout>
  );
}
