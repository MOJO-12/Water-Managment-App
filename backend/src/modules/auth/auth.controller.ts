import type { Request, Response } from 'express';
import { authService } from './auth.service';

const meta = (req: Request) => ({ ip: req.ip, userAgent: req.get('user-agent')?.slice(0, 255) });

export const authController = {
  register: async (req: Request, res: Response) => {
    res.status(201).json(await authService.register(req.body));
  },
  verifyOtp: async (req: Request, res: Response) => {
    res.json(await authService.verifyRegistration(req.body.phone, req.body.code, meta(req)));
  },
  resendOtp: async (req: Request, res: Response) => {
    res.json(await authService.resendRegistrationOtp(req.body.phone));
  },
  login: async (req: Request, res: Response) => {
    res.json(await authService.login(req.body.phone, req.body.password, meta(req)));
  },
  refresh: async (req: Request, res: Response) => {
    res.json(await authService.refresh(req.body.refreshToken, meta(req)));
  },
  logout: async (req: Request, res: Response) => {
    res.json(await authService.logout(req.body.refreshToken));
  },
  me: async (req: Request, res: Response) => {
    res.json(await authService.me(req.auth!.userId));
  },
};
