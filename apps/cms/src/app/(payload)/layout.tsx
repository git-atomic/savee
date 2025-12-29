// Route-group layout for Payload pages. We already mount the app-level
// RootLayout in `apps/cms/src/app/layout.tsx`. To avoid nested <html>/<body>
// and hydration issues, this group layout simply passes through children and
// mounts client bootstrap.
import React from "react";
import ClientBootstrap from "@/components/ClientBootstrap";
import "@payloadcms/next/css";

type Args = { children: React.ReactNode };

export default function Layout({ children }: Args) {
  return (
    <>
      <ClientBootstrap />
      {children}
    </>
  );
}
