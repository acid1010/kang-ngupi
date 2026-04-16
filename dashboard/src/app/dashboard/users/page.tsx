"use client";

import { useEffect, useState, FormEvent } from "react";
import { useAuth } from "@/lib/auth-context";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { getUsers, createUser, User } from "@/lib/api";
import { UserPlus, Users, Loader2, Shield, Truck as TruckIcon } from "lucide-react";
import { toast } from "sonner";

export default function UsersPage() {
  const { user } = useAuth();
  const router = useRouter();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [creating, setCreating] = useState(false);

  // Form state
  const [formName, setFormName] = useState("");
  const [formUsername, setFormUsername] = useState("");
  const [formPassword, setFormPassword] = useState("");
  const [formRole, setFormRole] = useState("kurir");

  useEffect(() => {
    if (user && user.role !== "admin") {
      router.replace("/dashboard");
      return;
    }
    fetchUsers();
  }, [user, router]);

  async function fetchUsers() {
    try {
      setLoading(true);
      const res = await getUsers();
      setUsers(res.data || []);
    } catch {
      toast.error("Gagal memuat data pengguna");
    } finally {
      setLoading(false);
    }
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setCreating(true);
    try {
      await createUser({
        name: formName,
        username: formUsername,
        password: formPassword,
        role: formRole,
      });
      toast.success("Pengguna berhasil dibuat");
      setShowForm(false);
      setFormName("");
      setFormUsername("");
      setFormPassword("");
      setFormRole("kurir");
      fetchUsers();
    } catch (err) {
      toast.error("Gagal membuat pengguna");
    } finally {
      setCreating(false);
    }
  }

  if (user?.role !== "admin") return null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Pengguna</h1>
          <p className="text-sm text-white/50 mt-0.5">Kelola akun admin & kurir</p>
        </div>
        <Button onClick={() => setShowForm(!showForm)} size="sm">
          <UserPlus className="w-4 h-4 mr-1.5" />
          Tambah
        </Button>
      </div>

      {/* Create form */}
      {showForm && (
        <Card className="border-[#1F8A8A]/30">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Buat Pengguna Baru</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleCreate} className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-white/60">Nama</label>
                  <Input
                    placeholder="Nama lengkap"
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-white/60">Username</label>
                  <Input
                    placeholder="Username login"
                    value={formUsername}
                    onChange={(e) => setFormUsername(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-white/60">Password</label>
                  <Input
                    type="password"
                    placeholder="Password"
                    value={formPassword}
                    onChange={(e) => setFormPassword(e.target.value)}
                    required
                    minLength={6}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-white/60">Role</label>
                  <Select
                    value={formRole}
                    onChange={(e) => setFormRole(e.target.value)}
                  >
                    <option value="kurir">Kurir</option>
                    <option value="admin">Admin</option>
                  </Select>
                </div>
              </div>
              <div className="flex gap-2 pt-1">
                <Button type="submit" size="sm" disabled={creating}>
                  {creating ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                      Membuat...
                    </>
                  ) : (
                    "Buat Pengguna"
                  )}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowForm(false)}
                >
                  Batal
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Users list */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 text-[#2BB5B5] animate-spin" />
        </div>
      ) : users.length === 0 ? (
        <div className="text-center py-12">
          <Users className="w-12 h-12 text-white/30 mx-auto mb-3" />
          <p className="text-white/50">Belum ada pengguna</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {users.map((u) => (
            <Card key={u.id} className="border-[#1e4040]/50">
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <div
                    className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                      u.role === "admin"
                        ? "bg-[#3CC8C8]/10"
                        : "bg-blue-500/10"
                    }`}
                  >
                    {u.role === "admin" ? (
                      <Shield className="w-5 h-5 text-[#3CC8C8]" />
                    ) : (
                      <TruckIcon className="w-5 h-5 text-blue-400" />
                    )}
                  </div>
                  <div>
                    <p className="font-medium text-white">{u.name}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-xs text-white/50">@{u.username}</span>
                      <Badge
                        className={
                          u.role === "admin"
                            ? "bg-[#3CC8C8]/20 text-[#3CC8C8] border-[#2BB5B5]/30"
                            : "bg-blue-500/20 text-blue-400 border-blue-500/30"
                        }
                      >
                        {u.role}
                      </Badge>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
