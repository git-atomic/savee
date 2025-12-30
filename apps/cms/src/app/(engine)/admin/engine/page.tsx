import { getPayload } from "payload";
import configPromise from "@payload-config";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { ComponentExample } from "./EngineClient";

export default async function EnginePage() {
  const payload = await getPayload({ config: configPromise });
  const { user } = await payload.auth({ headers: await headers() });

  if (!user) {
    redirect("/admin/login?redirect=%2Fadmin%2Fengine");
  }

  return <ComponentExample />;
}
