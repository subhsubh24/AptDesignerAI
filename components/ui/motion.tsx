"use client";

import { forwardRef } from "react";
import { motion, useInView, type HTMLMotionProps, type Variants, AnimatePresence } from "framer-motion";
import { useRef } from "react";

const springSnappy = { type: "spring" as const, stiffness: 400, damping: 25 };
const springBouncy = { type: "spring" as const, stiffness: 300, damping: 20 };
const springGentle = { type: "spring" as const, stiffness: 200, damping: 24 };

export const MotionDiv = motion.div;
export const MotionButton = motion.button;
export { AnimatePresence };

export const fadeInUp: Variants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: springGentle },
};

export const fadeIn: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.3 } },
};

export const scaleIn: Variants = {
  hidden: { opacity: 0, scale: 0.92 },
  visible: { opacity: 1, scale: 1, transition: springBouncy },
};

export const slideInRight: Variants = {
  hidden: { opacity: 0, x: 24 },
  visible: { opacity: 1, x: 0, transition: springGentle },
};

export const slideInLeft: Variants = {
  hidden: { opacity: 0, x: -24 },
  visible: { opacity: 1, x: 0, transition: springGentle },
};

export const staggerContainer: Variants = {
  hidden: {},
  visible: {
    transition: {
      staggerChildren: 0.06,
      delayChildren: 0.04,
    },
  },
};

export const staggerContainerSlow: Variants = {
  hidden: {},
  visible: {
    transition: {
      staggerChildren: 0.1,
      delayChildren: 0.08,
    },
  },
};

export const cardLift: Variants = {
  rest: { y: 0, boxShadow: "0 1px 3px rgba(0,0,0,0.06)" },
  hover: {
    y: -4,
    boxShadow: "0 12px 32px rgba(0,0,0,0.08)",
    transition: springSnappy,
  },
  tap: { scale: 0.985, transition: { duration: 0.1 } },
};

export const buttonPress = {
  whileTap: { scale: 0.97, transition: { type: "spring", stiffness: 500, damping: 30 } },
  whileHover: { scale: 1.02, transition: { type: "spring", stiffness: 400, damping: 25 } },
};

export const buttonPressSubtle = {
  whileTap: { scale: 0.98, transition: { type: "spring", stiffness: 500, damping: 30 } },
};

export const scorePop: Variants = {
  hidden: { opacity: 0, scale: 0.5 },
  visible: {
    opacity: 1,
    scale: 1,
    transition: { ...springBouncy, delay: 0.1 },
  },
};

interface StaggerListProps extends HTMLMotionProps<"div"> {
  children: React.ReactNode;
}

export const StaggerList = forwardRef<HTMLDivElement, StaggerListProps>(
  ({ children, ...props }, ref) => (
    <motion.div
      ref={ref}
      variants={staggerContainer}
      initial="hidden"
      animate="visible"
      {...props}
    >
      {children}
    </motion.div>
  )
);
StaggerList.displayName = "StaggerList";

interface StaggerItemProps extends HTMLMotionProps<"div"> {
  children: React.ReactNode;
}

export const StaggerItem = forwardRef<HTMLDivElement, StaggerItemProps>(
  ({ children, ...props }, ref) => (
    <motion.div ref={ref} variants={fadeInUp} {...props}>
      {children}
    </motion.div>
  )
);
StaggerItem.displayName = "StaggerItem";

interface PageTransitionProps {
  children: React.ReactNode;
  className?: string;
}

export function PageTransition({ children, className }: PageTransitionProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={springGentle}
      className={className}
    >
      {children}
    </motion.div>
  );
}

interface CardHoverProps extends HTMLMotionProps<"div"> {
  children: React.ReactNode;
}

export const CardHover = forwardRef<HTMLDivElement, CardHoverProps>(
  ({ children, ...props }, ref) => (
    <motion.div
      ref={ref}
      variants={cardLift}
      initial="rest"
      whileHover="hover"
      whileTap="tap"
      {...props}
    >
      {children}
    </motion.div>
  )
);
CardHover.displayName = "CardHover";

interface ScrollRevealProps {
  children: React.ReactNode;
  className?: string;
  delay?: number;
}

export function ScrollReveal({ children, className, delay = 0 }: ScrollRevealProps) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-60px" });

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 24 }}
      animate={inView ? { opacity: 1, y: 0 } : { opacity: 0, y: 24 }}
      transition={{ ...springGentle, delay }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

interface ScrollStaggerProps {
  children: React.ReactNode;
  className?: string;
}

export function ScrollStagger({ children, className }: ScrollStaggerProps) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-40px" });

  return (
    <motion.div
      ref={ref}
      variants={staggerContainer}
      initial="hidden"
      animate={inView ? "visible" : "hidden"}
      className={className}
    >
      {children}
    </motion.div>
  );
}
