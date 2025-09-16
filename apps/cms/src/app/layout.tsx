import React from "react";

export const metadata = {
  title: "ScrapeSavee",
  description: "Admin & engine UI",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
