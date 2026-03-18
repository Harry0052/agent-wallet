import { redirect } from "next/navigation";

export default function SubscriptionsRedirectPage() {
  redirect("/transactions");
}
