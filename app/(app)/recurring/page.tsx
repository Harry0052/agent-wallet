import { redirect } from "next/navigation";

export default function RecurringRedirectPage() {
  redirect("/transactions");
}
