import { createRouter, createWebHistory } from 'vue-router'

// 懒加载
const Test = () => import('../pages/test.vue')
const Home = () => import('../pages/Home.vue')

const router = createRouter({
  history: createWebHistory(),
  routes: [{
    path: '/',
    redirect: 'test'
  }, {
    path: '/test',
    component: Test
  }, {
    path: '/home',
    component: Home
  }]
})

export default router