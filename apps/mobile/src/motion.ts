import { Animated, Easing, AccessibilityInfo } from 'react-native';
export async function prefersReducedMotion(): Promise<boolean> { return AccessibilityInfo.isReduceMotionEnabled(); }
/** 120Hz-friendly motion: compositor-driven native animations, no JS frame loop. */
export function springValue(value: Animated.Value, toValue: number) { return Animated.spring(value, { toValue, useNativeDriver:true, damping:24, stiffness:260, mass:.7 }); }
export function fade(value: Animated.Value, toValue: number, duration = 140) { return Animated.timing(value, { toValue, duration, easing:Easing.out(Easing.cubic), useNativeDriver:true }); }
