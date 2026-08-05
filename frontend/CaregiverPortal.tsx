"use client";

import { useState } from "react";
import type { CaregiverSessionUser } from "../backend/services/caregiverAuth";
import CaregiverApp from "./CaregiverApp";
import CaregiverLogin from "./CaregiverLogin";
import { clearServerSession } from "./firebaseAuth";

type CaregiverPortalProps = {
  initialUser: CaregiverSessionUser | null;
};

export default function CaregiverPortal({ initialUser }: CaregiverPortalProps) {
  const [user, setUser] = useState<CaregiverSessionUser | null>(initialUser);

  const logout = async () => {
    await clearServerSession().catch(() => undefined);
    setUser(null);
  };

  if (!user) return <CaregiverLogin onAuthenticated={setUser} />;
  return <CaregiverApp caregiver={user} onLogout={logout} />;
}
