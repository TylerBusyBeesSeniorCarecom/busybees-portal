import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export function middleware(request: NextRequest) {
  const isLoggedIn = request.cookies.get('next-auth.session-token') 
    || request.cookies.get('__Secure-next-auth.session-token')

  const { pathname } = request.nextUrl

  // Allow these routes without auth
  if (
    pathname.startsWith('/api/auth') ||
    pathname.startsWith('/login') ||
    pathname.startsWith('/_next') ||
    pathname.startsWith('/favicon.ico')
  ) {
    return NextResponse.next()
  }

  // If not logged in → redirect to login
  if (!isLoggedIn) {
    const loginUrl = new URL('/login', request.url)
    return NextResponse.redirect(loginUrl)
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    /*
     Protect everything except static files
    */
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
}