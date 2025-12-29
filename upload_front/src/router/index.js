import { createRouter, createWebHistory } from 'vue-router'

// 懒加载
const Home = () => import('../pages/Home.vue')

const router = createRouter({
  history: createWebHistory(),
  routes: [{
    path: '/',
    redirect: 'home'
  }, {
    path: '/home',
    component: Home
  }]
})

export default router