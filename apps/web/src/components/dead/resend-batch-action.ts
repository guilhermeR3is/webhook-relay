"use server";

import { revalidatePath } from "next/cache";
import { resendDeliveries, type BatchResendResult } from "@/lib/resend";

export async function resendBatchAction(deliveryIds: string[]): Promise<BatchResendResult> {
  const result = await resendDeliveries(deliveryIds);
  // com a API fora do ar, recarregar a página trocaria a lista pela tela de "acordando"
  if (result.kind === "done") revalidatePath("/dead");
  return result;
}
