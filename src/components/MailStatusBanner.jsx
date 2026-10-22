import { useEffect, useState } from "react";
import { MAIL_NOTICE_EVENT, readMailNotice, statusLine } from "../utils/mailNotice";

export default function MailStatusBanner() {
  const [notice, setNotice] = useState(() => readMailNotice());

  useEffect(() => {
    const sync = () => setNotice(readMailNotice());
    window.addEventListener(MAIL_NOTICE_EVENT, sync);
    return () => window.removeEventListener(MAIL_NOTICE_EVENT, sync);
  }, []);

  const text = statusLine(notice);
  if (!text) return null;
  return (
    <p className={`mail-banner ${notice?.state || "error"}`} role="status">
      {text}
    </p>
  );
}
