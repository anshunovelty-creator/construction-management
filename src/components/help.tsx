/** How to fill something in. On a phone it is folded behind its heading, so it does not push the boxes off the screen. */
export function Help({ title, className = 'hint', children }: { title: string; className?: string; children: React.ReactNode }) {
  return (
    <>
      <p className={`${className} wide-only`}>{children}</p>
      <details className="help phone-only"><summary>{title}</summary><p>{children}</p></details>
    </>
  );
}
