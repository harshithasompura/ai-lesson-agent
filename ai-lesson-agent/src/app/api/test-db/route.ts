import pool from "@/lib/db";
import { NextResponse } from "next/server";

export async function GET() {
  const result = await pool.query("SELECT 1");

  return NextResponse.json({
    success: true,
    rows: result.rows,
  });
}