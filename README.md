This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Supabase 연결

1. [Supabase](https://supabase.com)에서 프로젝트를 만듭니다.
2. **Project Settings → API**에서 `Project URL`, `anon public` 키를 복사합니다.
3. 프로젝트 루트에 `.env.local` 파일을 만들고 아래처럼 넣습니다. (`env.local.example` 참고)

```bash
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
```

4. 의존성 설치 후 개발 서버 실행:

```bash
npm install
npm run dev
```

5. 클라이언트 컴포넌트에서 사용:

```ts
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

const supabase = getSupabaseBrowserClient();
// 예: const { data } = await supabase.from("birds").select("*");
```

서버 전용 작업(Row Level Security 우회 등)이 필요하면 **service role** 키는 `.env.local`에만 두고, **`NEXT_PUBLIC_` 접두사를 붙이지 마세요.** (브라우저에 노출됨)

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3001](http://localhost:3001) (or [http://127.0.0.1:3001](http://127.0.0.1:3001)) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
