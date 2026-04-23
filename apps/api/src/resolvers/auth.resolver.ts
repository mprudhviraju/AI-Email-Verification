import { prisma } from '../lib/context.js';
import { signToken, hashPassword, comparePassword } from '../lib/auth.js';
import type { AppContext } from '../lib/context.js';

export const authResolvers = {
  Query: {
    me: async (_: unknown, __: unknown, ctx: AppContext) => {
      if (!ctx.userId) return null;
      return prisma.user.findUnique({
        where: { id: ctx.userId },
        select: { id: true, email: true, createdAt: true },
      });
    },
  },

  Mutation: {
    register: async (_: unknown, { email, password }: { email: string; password: string }) => {
      const existing = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
      if (existing) throw new Error('Email already registered');

      const user = await prisma.user.create({
        data: { email: email.toLowerCase(), password: await hashPassword(password) },
      });
      return { token: signToken(user.id), user };
    },

    login: async (_: unknown, { email, password }: { email: string; password: string }) => {
      const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
      if (!user) throw new Error('Invalid email or password');

      const valid = await comparePassword(password, user.password);
      if (!valid) throw new Error('Invalid email or password');

      return { token: signToken(user.id), user };
    },
  },

  User: {
    createdAt: (u: { createdAt: Date }) => u.createdAt.toISOString(),
  },
};
