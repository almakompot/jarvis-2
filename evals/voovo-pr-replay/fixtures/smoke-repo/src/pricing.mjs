export function applyCoupon(subtotal, couponCode) {
  if (couponCode === "WELCOME10") {
    return Math.max(0, subtotal - 10);
  }
  return subtotal;
}

