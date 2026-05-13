import { NextResponse } from "next/server";
import { cancelTransfer } from "@/lib/transfers";
import { requireAuth, AuthError } from "@/lib/auth/middleware";
import {
  TransferNotFoundError,
  NotTransferOwnerError,
  CancelTooLateError,
  InvalidTransitionError,
} from "@/lib/transfers/errors";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { userId } = await requireAuth(request);
    const { id } = await params;

    const transfer = await cancelTransfer({ transferId: id, userId });
    return NextResponse.json({ transfer });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.statusCode },
      );
    }
    if (error instanceof TransferNotFoundError)
      return NextResponse.json({ error: error.message }, { status: 404 });
    if (error instanceof NotTransferOwnerError)
      return NextResponse.json({ error: error.message }, { status: 403 });
    // Typed `reason` literals so iOS dispatches on the enum, not on
    // bare HTTP 409. CancelTooLate → user has already pushed AUD;
    // InvalidTransition → caller and backend disagree about state
    // (most often: a duplicate cancel after CANCELLED, treated as
    // idempotent success at src/lib/transfers/cancel.ts and never
    // reaches this branch — but keep the explicit reason in case
    // another path reaches here, e.g. cancelling EXPIRED).
    if (error instanceof CancelTooLateError) {
      return NextResponse.json(
        { error: error.message, reason: "cancel_too_late" },
        { status: 409 },
      );
    }
    if (error instanceof InvalidTransitionError) {
      return NextResponse.json(
        { error: error.message, reason: "invalid_transition" },
        { status: 409 },
      );
    }

    const message = error instanceof Error ? error.message : "Cancel failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
