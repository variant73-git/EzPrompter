import { NextResponse } from 'next/server';
import { getCapture, deleteCapture } from '../../../../lib/redis.js';

export async function GET(request, { params }) {
  try {
    const { id } = await params;
    const data = await getCapture(`capture:${id}`);

    if (!data) {
      return NextResponse.json(
        { error: 'Capture not found or expired' },
        { status: 404 }
      );
    }

    return NextResponse.json(data);
  } catch (err) {
    console.error('Capture get error:', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function DELETE(request, { params }) {
  try {
    const { id } = await params;
    await deleteCapture(`capture:${id}`);
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Capture delete error:', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
