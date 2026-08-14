import { cookies } from "next/headers";
import SilverLensApp from "../frontend/SilverLensApp";
import {
  SERVICE_INTRO_COOKIE_NAME,
  SERVICE_INTRO_COOKIE_VALUE,
} from "../shared/serviceIntro";

export const dynamic = "force-dynamic";

export default async function Home() {
  const cookieStore = await cookies();
  const initialIntroSeen =
    cookieStore.get(SERVICE_INTRO_COOKIE_NAME)?.value ===
    SERVICE_INTRO_COOKIE_VALUE;

  return <SilverLensApp initialIntroSeen={initialIntroSeen} />;
}
