"use client";

import { useRef, useState, useEffect } from "react";
import { motion, type HTMLMotionProps } from "framer-motion";

const CYCLES_PER_LETTER = 3;
const SHUFFLE_TIME = 30;
const CHARS = "!@#$%^&*():{};|,.<>/?ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

function getRandomScrambledText(target: string, pos: number) {
  return target
    .split("")
    .map((char, index) => {
      if (pos / CYCLES_PER_LETTER > index) {
        return char;
      }
      const randomCharIndex = Math.floor(Math.random() * CHARS.length);
      return CHARS[randomCharIndex];
    })
    .join("");
}

function useScrambledText(initialText: string) {
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [text, setText] = useState(initialText);

  const stopScramble = () => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    setText(initialText);
  };

  const scramble = () => {
    let pos = 0;
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
    }

    intervalRef.current = setInterval(() => {
      setText(getRandomScrambledText(initialText, pos));
      pos++;
      if (pos >= initialText.length * CYCLES_PER_LETTER) {
        stopScramble();
      }
    }, SHUFFLE_TIME);
  };

  return { text, scramble, stopScramble };
}

function TextButton({
  label,
  className = "",
  ...props
}: { label: string } & HTMLMotionProps<"button">) {
  const { text, scramble, stopScramble } = useScrambledText(label);
  const [isHovered, setIsHovered] = useState(false);

  const handleMouseEnter = () => {
    setIsHovered(true);
    scramble();
  };

  const handleMouseLeave = () => {
    setIsHovered(false);
    stopScramble();
  };

  return (
    <motion.button
      {...props}
      whileHover={{ scale: 1.05 }}
      whileTap={{ scale: 0.98 }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      className={
        "relative group overflow-hidden rounded-lg bg-card/90 backdrop-blur-sm border border-border/50 px-3 py-1.5 shadow-md transition-all duration-300 text-left " +
        className
      }
      style={{
        boxShadow: isHovered
          ? "0 0 40px rgba(56, 189, 248, 0.25), inset 0 1px 0 rgba(255, 255, 255, 0.08)"
          : "0 10px 25px rgba(0, 0, 0, 0.18), inset 0 1px 0 rgba(255, 255, 255, 0.06)",
      }}
    >
      <motion.div
        className="absolute inset-0 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-300"
        style={{
          background: "linear-gradient(45deg, rgba(56, 189, 248, 0.35), rgba(168, 85, 247, 0.25), rgba(16, 185, 129, 0.25), rgba(251, 191, 36, 0.25))",
          backgroundSize: "300% 300%",
          padding: "1px",
        }}
        animate={{
          backgroundPosition: isHovered ? "0% 0%" : "100% 100%",
        }}
        transition={{
          duration: 2,
          repeat: Infinity,
          repeatType: "reverse",
        }}
      >
        <div className="w-full h-full bg-card/90 rounded-lg" />
      </motion.div>

      <div className="relative z-10 flex items-center justify-center gap-2">
        <motion.div
          animate={{
            rotateY: isHovered ? 180 : 0,
          }}
          transition={{ duration: 0.6, type: "spring", stiffness: 200 }}
          className="relative"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            className={`transition-colors duration-300 ${
              isHovered ? "text-cyan-400" : "text-foreground/70"
            }`}
          >
            <path
              d="M6 10V8C6 5.79 7.79 4 10 4H14C16.21 4 18 5.79 18 8V10"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M5 10H19C20.1 10 21 10.9 21 12V18C21 19.1 20.1 20 19 20H5C3.9 20 3 19.1 3 12V12C3 10.9 3.9 10 5 10Z"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <circle
              cx="12"
              cy="15"
              r="2"
              fill="currentColor"
              className={`transition-all duration-300 ${
                isHovered ? "opacity-100" : "opacity-60"
              }`}
            />
          </svg>
        </motion.div>

        <span
          className={`font-mono text-xs font-bold tracking-wider transition-all duration-300 ${
            isHovered
              ? "text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 via-purple-400 to-emerald-400"
              : "text-foreground"
          }`}
          style={{ fontFamily: "JetBrains Mono, Consolas, monospace" }}
        >
          {text}
        </span>
      </div>

      <motion.div
        className="absolute inset-0 pointer-events-none"
        animate={{
          background: isHovered
            ? "radial-gradient(circle at 50% 50%, rgba(56, 189, 248, 0.12) 0%, transparent 70%)"
            : "transparent",
        }}
        transition={{ duration: 0.3 }}
      />

      <motion.div
        className="absolute inset-0 overflow-hidden rounded-lg"
        initial={false}
        animate={{
          opacity: isHovered ? 1 : 0,
        }}
        transition={{ duration: 0.3 }}
      >
        <motion.div
          className="absolute top-0 left-0 w-full h-0.5 bg-gradient-to-r from-transparent via-cyan-400 to-transparent"
          animate={{
            y: isHovered ? [0, 60, 0] : 0,
            opacity: isHovered ? [0, 1, 0] : 0,
          }}
          transition={{
            duration: 2,
            repeat: Infinity,
            ease: "easeInOut",
          }}
        />
      </motion.div>

      {[...Array(5)].map((_, i) => (
        <motion.div
          key={i}
          className="absolute w-1 h-1 rounded-full bg-cyan-400 opacity-0"
          style={{
            left: `${18 + i * 12}%`,
            top: `${30 + (i % 3) * 18}%`,
          }}
          animate={{
            opacity: isHovered ? [0, 1, 0] : 0,
            scale: isHovered ? [0, 1, 0] : 0,
            y: isHovered ? [0, -18, 0] : 0,
          }}
          transition={{
            duration: 2,
            delay: i * 0.15,
            repeat: Infinity,
          }}
        />
      ))}
    </motion.button>
  );
}

export function AuthActionButton({
  label,
  className,
  ...props
}: { label: string } & HTMLMotionProps<"button">) {
  return <TextButton label={label} className={className} {...props} />;
}

export function BrandLogo({
  text = "WaSfY",
  className,
}: {
  text?: string;
  className?: string;
}) {
  const { text: displayText, scramble } = useScrambledText(text);

  useEffect(() => {
    scramble();
    const interval = setInterval(scramble, 4000);
    return () => clearInterval(interval);
  }, []);

  return (
    <span className={"relative inline-block " + (className ?? "")}>
      <motion.span
        className="font-mono text-lg font-bold tracking-widest sm:text-xl text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 via-purple-400 to-emerald-400"
        style={{
          fontFamily: "JetBrains Mono, Consolas, monospace",
          backgroundSize: "200% 200%",
        }}
        animate={{
          backgroundPosition: ["0% 50%", "100% 50%", "0% 50%"],
        }}
        transition={{
          duration: 4,
          repeat: Infinity,
          ease: "easeInOut",
        }}
      >
        {displayText}
      </motion.span>

      <motion.span
        className="absolute inset-0 font-mono text-lg font-bold tracking-widest sm:text-xl text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 via-purple-400 to-emerald-400 blur-md opacity-50"
        style={{
          fontFamily: "JetBrains Mono, Consolas, monospace",
          backgroundSize: "200% 200%",
        }}
        animate={{
          backgroundPosition: ["0% 50%", "100% 50%", "0% 50%"],
          opacity: [0.3, 0.6, 0.3],
        }}
        transition={{
          duration: 4,
          repeat: Infinity,
          ease: "easeInOut",
        }}
        aria-hidden="true"
      >
        {displayText}
      </motion.span>
    </span>
  );
}
