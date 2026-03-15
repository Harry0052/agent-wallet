import { redirect } from "next/navigation";

export default function StatementsRedirectPage() {
  redirect("/transactions");
}
