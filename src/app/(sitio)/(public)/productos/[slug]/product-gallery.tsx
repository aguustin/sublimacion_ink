"use client";

import { ImageOff } from "lucide-react";
import { useState } from "react";
import styles from "./product.module.css";

/**
 * Galería del detalle de producto (Documento Maestro, 5.4): imagen principal y miniaturas debajo.
 * Las URL son firmadas y de corta duración (16.1); no pasan por el optimizador de imágenes.
 */
export function ProductGallery({ images, name }: { images: string[]; name: string }) {
  const [current, setCurrent] = useState(0);

  if (images.length === 0) {
    // Sin fotos cargadas: una superficie neutra, sin imágenes inventadas.
    return (
      <div className={styles.gallery}>
        <div className={`${styles.mainImage} ${styles.noImage}`}>
          <ImageOff aria-hidden="true" size={48} />
          <span>Sin fotos por ahora</span>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.gallery}>
      <div className={styles.mainImage}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={images[current]} alt={name} />
      </div>
      {images.length > 1 && (
        <ul className={styles.thumbs} aria-label="Fotos del producto">
          {images.map((src, index) => (
            <li key={src}>
              <button
                type="button"
                className={styles.thumb}
                aria-label={`Ver foto ${index + 1} de ${images.length}`}
                aria-pressed={index === current}
                onClick={() => setCurrent(index)}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={src} alt="" loading="lazy" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
