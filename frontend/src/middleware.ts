import { NextRequest, NextResponse } from "next/server";

// Proteção de rotas feita client-side via loadAuth() em cada página.
// Middleware não tem acesso ao localStorage, então passa tudo adiante.
export function middleware(_request: NextRequest) {
  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*"],
};
