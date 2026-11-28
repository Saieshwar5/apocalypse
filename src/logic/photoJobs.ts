/**
 * Photo jobs: Halo's public-relations office pays for a good picture of
 * something in orbit. Take it in photo mode (P) with the subject in frame,
 * close enough and not too small.
 */
export type PhotoSubject = 'aurora' | 'vulcan' | 'ceres' | 'halo' | 'meteors' | 'rival';

export const PHOTO_JOBS: Record<PhotoSubject, { title: string; pay: number; maxDistance: number }> = {
  aurora: { title: 'the aurora over the pole', pay: 260, maxDistance: 140 },
  vulcan: { title: 'Vulcan Yard at work', pay: 200, maxDistance: 45 },
  ceres: { title: 'Ceres Works', pay: 200, maxDistance: 45 },
  halo: { title: 'Halo and its spacewalkers', pay: 220, maxDistance: 35 },
  meteors: { title: 'the meteor shower', pay: 300, maxDistance: 160 },
  rival: { title: 'a rival ship in flight', pay: 240, maxDistance: 30 },
};

/**
 * Is the subject well framed? `offCentre` is the angle from the view
 * centre in radians, `halfFov` the camera's half field of view.
 */
export function framed(distance: number, offCentre: number, halfFov: number, subject: PhotoSubject): boolean {
  return distance <= PHOTO_JOBS[subject].maxDistance && offCentre <= halfFov * 0.7;
}
