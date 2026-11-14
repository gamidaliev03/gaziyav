self.__BUILD_MANIFEST = {
  "__rewrites": {
    "afterFiles": [],
    "beforeFiles": [
      {
        "source": ((typeof document!=="undefined"||/^blob:/.test(self.location.href)?"./":(function(h){var i=h.indexOf("/_next/");return i>=0?h.slice(0,i+1):new URL("./",h).href})(self.location.href))+"_next/:path+"),
        "destination": "/_next/:path+"
      }
    ],
    "fallback": []
  },
  "sortedPages": [
    "/_app",
    "/_error"
  ]
};self.__BUILD_MANIFEST_CB && self.__BUILD_MANIFEST_CB()