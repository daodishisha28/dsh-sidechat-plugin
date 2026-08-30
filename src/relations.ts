/** Cross-parent edges require positive canonical workspace evidence, not undefined equality. */
export function sameKnownWorkspace(left: string | undefined, right: string | undefined): boolean {
  return left !== undefined && right !== undefined && left === right
}
