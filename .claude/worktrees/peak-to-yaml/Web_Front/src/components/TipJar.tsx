import { useState, useEffect } from 'react';

interface TipJarProps {
  activeTab?: string;
  hasData?: boolean;
  audioCount?: number;
}

export default function TipJar({ activeTab, hasData, audioCount }: TipJarProps) {
  const [danceClass, setDanceClass] = useState('');

  useEffect(() => {
    let timeout: number;
    const triggerDance = () => {
      const classes = ['wiggle-rotate', 'wiggle-updown', 'wiggle-leftright', 'wiggle-shake'];
      const randomClass = classes[Math.floor(Math.random() * classes.length)];
      setDanceClass(randomClass);
      timeout = window.setTimeout(() => setDanceClass(''), 800); // Wait for animation to finish
    };

    // Trigger on prop changes
    triggerDance();

    // Trigger every 20 seconds
    const interval = setInterval(() => {
      triggerDance();
    }, 20000);

    return () => {
      clearInterval(interval);
      clearTimeout(timeout);
    };
  }, [activeTab, hasData, audioCount]);

  return (
    <a
      href="https://www.paypal.com/paypalme/APKaudio"
      target="_blank"
      rel="noopener noreferrer"
      className={danceClass}
      style={{
        fontSize: '0.7rem',
        color: 'var(--accent-primary)',
        textDecoration: 'none',
        fontWeight: 600,
        display: 'inline-block',
        transformOrigin: 'center',
      }}
      title="Support this project!"
    >
      ☕ Tip Jar
    </a>
  );
}
