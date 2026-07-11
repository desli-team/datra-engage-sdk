import { createDatraEngageActionHandler } from "@datra/engage-sdk";

export const handleHotyDogyDatraAction = createDatraEngageActionHandler({
  onOpenScreen: async (screen) => {
    navigate(screen);
  },
  onOpenPromotion: async (promotionId) => {
    navigate("promotion", { promotionId });
  },
  onOpenCoupon: async (couponId) => {
    navigate("coupon", { couponId });
  },
  onOpenProduct: async (productId) => {
    navigate("product", { productId });
  },
  onOpenCart: async () => {
    navigate("cart");
  },
  onOpenUrl: async (url) => {
    openUrl(url);
  },
  onUnhandledAction: async (action) => {
    console.warn("Unhandled Datra Engage action", action);
  },
});

function navigate(route: string, params?: Record<string, string>) {
  console.log("Navigate", route, params);
}

function openUrl(url: string) {
  console.log("Open URL", url);
}
