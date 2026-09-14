import { Link, NavLink, type LinkProps, type NavLinkProps } from 'react-router-dom';
import { useReducedMotion } from '../lib/motion';

/** `Link` with a view transition unless the person asked for reduced motion. */
export function AppLink(props: LinkProps) {
  const reduced = useReducedMotion();
  return <Link viewTransition={!reduced} {...props} />;
}

export function AppNavLink(props: NavLinkProps) {
  const reduced = useReducedMotion();
  return <NavLink viewTransition={!reduced} {...props} />;
}
