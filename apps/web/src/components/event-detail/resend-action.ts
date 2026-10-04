"use server";

import { revalidatePath } from "next/cache";
import { resendDelivery, type ResendResult } from "@/lib/resend";

export async function resendDeliveryAction(deliveryId: string): Promise<ResendResult> {
  const result = await resendDelivery(deliveryId);
  // com a API fora do ar, recarregar a página trocaria o detalhe pela tela de "acordando"
  if (result !== "unavailable") revalidatePath("/events/[eventId]", "page");
  return result;
}
