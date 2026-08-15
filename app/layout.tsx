import type { Metadata } from "next";
import { Geist } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export async function generateMetadata(): Promise<Metadata> {
  const host = (await headers()).get("host") ?? "localhost:3000";
  const protocol = host.includes("localhost") ? "http" : "https";
  const image = `${protocol}://${host}/og.png`;
  return {
    title: "Lingua — ваш личный словарь",
    description: "Добавляйте собственные слова из текста, документов и изображений. Повторяйте ошибки удобным способом.",
    icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
    openGraph: { title: "Lingua — ваш личный словарь", description: "Добавляйте слова. Повторяйте ошибки.", images: [image] },
    twitter: { card: "summary_large_image", title: "Lingua — ваш личный словарь", description: "Добавляйте слова. Повторяйте ошибки.", images: [image] },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru">
      <head>
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Material+Symbols+Rounded:opsz,wght,FILL,GRAD@20,300,0..1,0&icon_names=delete,download,edit,volume_up&display=block" />
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..24,400,0,0&icon_names=add,brand_awareness,delete,download,edit,keyboard_arrow_down&display=block" />
      </head>
      <body className={`${geistSans.variable} antialiased`}>
        {children}
      </body>
    </html>
  );
}
