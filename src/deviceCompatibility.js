export function isPhoneLikeDevice({
  userAgent = '',
  userAgentDataMobile = false,
  platform = '',
  maxTouchPoints = 0,
  screenWidth = 0,
  screenHeight = 0,
  coarsePointer = false,
} = {}) {
  const ua = String(userAgent);
  const ipad = /iPad/i.test(ua) || (/MacIntel/i.test(platform) && Number(maxTouchPoints) > 1);
  if (ipad) return false;
  if (/Android/i.test(ua) && !/Mobile/i.test(ua)) return false;
  if (/Tablet|Silk|Kindle|PlayBook/i.test(ua)) return false;
  if (userAgentDataMobile === true) return true;
  if (/iPhone|iPod|Android.+Mobile|Windows Phone|IEMobile|Opera Mini|Opera Mobi/i.test(ua)) return true;

  const smallestSide = Math.min(Number(screenWidth) || Infinity, Number(screenHeight) || Infinity);
  return Boolean(coarsePointer && smallestSide < 600);
}

export function detectPhoneLikeDevice(windowObject = window) {
  const navigatorObject = windowObject.navigator || {};
  return isPhoneLikeDevice({
    userAgent: navigatorObject.userAgent,
    userAgentDataMobile: navigatorObject.userAgentData?.mobile,
    platform: navigatorObject.platform,
    maxTouchPoints: navigatorObject.maxTouchPoints,
    screenWidth: windowObject.screen?.width,
    screenHeight: windowObject.screen?.height,
    coarsePointer: windowObject.matchMedia?.('(pointer: coarse)')?.matches,
  });
}
