import Link from "next/link";

export default function HomePage() {
  return (
    <main>
      <h1>Sublimaciones</h1>
      <p>Tazas, remeras, stickers, carteles y más, estándar y personalizados.</p>
      <p>
        <Link href="/productos">Ver productos</Link> · <Link href="/cuenta">Mi cuenta</Link>
      </p>
    </main>
  );
}
