Components/aliimam/ Animated Canvas

Search `K`

Copy prompt

Copy codeView code

Vite + React + TS

AnimatedCanvas

[Components](https://21st.dev/community/components)• [aliimam](https://21st.dev/community/aliimam)• Animated Canvas

### Animated Canvas

The component will use a canvas to render the animation with configurable parameters.

### Created by

[![Ali Imam](https://vucvdpamtrjkzmubwlts.supabase.co/storage/v1/object/public/users/user_2rO0IUQINTfBex4xN8Ghho5dpr4/avatar.jpeg)](https://21st.dev/community/aliimam)

[Ali Imam](https://21st.dev/community/aliimam)

@aliimam

### Installation

```
npx shadcn@latest add https://21st.dev/r/designali-in/animated-canvas
```

### How to use

Copy prompt

Copy codeView code

```
import { AnimatedCanvas } from "@/components/ui/animated-canvas";

export default function DemoOne() {
  return (
    <div className="h-[400px] relative w-full flex items-center justify-center">
      <AnimatedCanvas
        count={50}
        lineColor={"#fff200"}
        heightMultiplier={0.4}
        speed={0.00002}
        lineWidth={2}
        className="h-80 w-full"
        direction={"right-to-left"}
      />
      <AnimatedCanvas
        count={50}
        lineColor={"#fff200"}
        heightMultiplier={0.4}
        speed={0.00002}
        lineWidth={2}
        className="h-80 w-full"
      />
      <span className="pointer-events-none top-10 absolute z-10 text-center text-7xl leading-none font-semibold tracking-tighter whitespace-pre-wrap">
        Animated
      </span>
       <span className="pointer-events-none bottom-10 absolute z-10 text-center text-7xl leading-none font-semibold tracking-tighter whitespace-pre-wrap">
        Canvas
      </span>
    </div>
  );
}
```

Created 9/10/2025Updated 9/10/2025

21st

`K`

[Home](https://21st.dev/)

### Explore

Components [Agent Templates](https://21st.dev/community/templates)

### Build

Agents [1Code](https://21st.dev/1code) [Magic Chat](https://21st.dev/magic)

21st Agents SDK

The fastest way to build and deploy AI agents.

[![](https://21st.dev/_next/image?url=%2Fnews-21st-sdk.png&w=3840&q=75)](https://21st.dev/agents)

[Read more](https://21st.dev/agents) Dismiss

We're in YC

21st is backed by Y Combinator. Excited for what's ahead!

[![](https://21st.dev/_next/image?url=%2Fnews-yc.png&w=3840&q=75)](https://www.ycombinator.com/companies/1code-21stdev)

[Read more](https://www.ycombinator.com/companies/1code-21stdev) Dismiss

Title

Description

[Read more](https://21st.dev/community/components/aliimam/animated-canvas/default#) Dismiss

Log in

 Animated Canvas \| Community Components - 21st \| 21st

Give us feedback

Tell us how we could make the product more useful for you.

General feedback`1`

Request feature for Canvas`2`

Request feature for Community`3`

Report Canvas bug`4`

Report Community bug`5`

[Powered by Featurebase](https://featurebase.app/?utm_campaign=21st&utm_content=feedback-widget&utm_medium=referral&utm_source=powered-by&utm_id=6932122694c477fa3d8aa4b3)