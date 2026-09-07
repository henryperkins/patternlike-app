type IconName = "left" | "right" | "plus" | "minus" | "home" | "expand";
const paths: Record<IconName, string> = {
  left: "M4 10a8 8 0 1 1 1.7 9M4 4v6h6",
  right: "M20 10a8 8 0 1 0-1.7 9M20 4v6h-6",
  plus: "M5 12h14M12 5v14",
  minus: "M5 12h14",
  home: "m3 11 9-8 9 8M6 9v12h12V9M10 21v-7h4v7",
  expand: "M9 3H3v6M15 3h6v6M21 15v6h-6M9 21H3v-6",
};
export function SceneIcon({ name }: { name: IconName }) {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d={paths[name]} /></svg>;
}
